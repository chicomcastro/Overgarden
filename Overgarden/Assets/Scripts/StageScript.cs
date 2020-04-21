using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class StageScript : MonoBehaviour
{
    int aux = 0;
    public GameObject virginGround;
    public GameObject plantStages;
    public PlantScriptableObject plant;
    public LifeBar lifeBar;
    public Slider progressionBar;
    public int maxStage = 100;
    public SpriteRenderer plantImage;
    public Sprite diedPlant;

    private int currentStage = 0;

    // Start is called before the first frame update
    void Start()
    {
        lifeBar.gameObject.SetActive(false);
        progressionBar.gameObject.SetActive(false);
        plantStages.SetActive(false);
        virginGround.SetActive(true);
        loadInitialState();
    }

    // Update is called once per frame
    void Update()
    {
        if (MenuManager.instance.isPaused)
        {
            return;
        }

        HandleState();

        if (progressionBar.value >= progressionBar.maxValue)
        {
            progressionBar.value = maxStage;
        }
        if (progressionBar.value <= progressionBar.minValue)
        {
            progressionBar.value = progressionBar.minValue;
        }

        if (lifeBar.slider.value == lifeBar.slider.minValue)
        {
            if (currentStage == (int)PlantStages.TREATED_GROUND || currentStage == (int)PlantStages.PLANT_DIED)
            {
                loadInitialState();
            }
            else
            {
                plantImage.sprite = diedPlant;
                currentStage = (int)PlantStages.PLANT_DIED;
            }
        }
    }

    private void HandleState()
    {
        switch (currentStage)
        {
            case (int)PlantStages.VIRGIN_GROUND:
                break;
            case (int)PlantStages.TREATED_GROUND:
                virginGround.SetActive(false);
                lifeBar.gameObject.SetActive(true);
                break;
            case (int)PlantStages.PLANT_SMALL:
            case (int)PlantStages.PLANT_MEDIUM:
            case (int)PlantStages.PLANT_GREAT:
                progressionBar.gameObject.SetActive(true);
                plantStages.SetActive(true);
                growing();
                if (progressionBar.value == maxStage)
                {
                    passStage();
                }
                break;
            case (int)PlantStages.PLANT_READY:
            case (int)PlantStages.PLANT_DIED:
                progressionBar.gameObject.SetActive(false);
                break;
        }
    }

    public void loadInitialState()
    {
        progressionBar.minValue = 0;
        progressionBar.maxValue = maxStage;
        progressionBar.value = maxStage;
        plant = null;
        lifeBar.gameObject.SetActive(false);
        progressionBar.gameObject.SetActive(false);
        plantStages.SetActive(false);
        virginGround.SetActive(true);
        currentStage = (int)PlantStages.VIRGIN_GROUND;
    }

    public void growing()
    {
        if (aux % getGrowingTime() == 0)
        {
            progressionBar.value++;
        }
        aux++;
        if (aux == 1000)
        {
            aux = 0;
        }
    }

    private int getGrowingTime()
    {
        return plant.plantRarity * 5;
    }

    private int getPlantRealState()
    {
        // The firsts 2 stages are about ground, not plant
        // And plant stages starts from 0
        return currentStage - 3;
    }

    public void passStage()
    {
        progressionBar.value = progressionBar.minValue;
        lifeBar.Reset();
        if (currentStage < (int)PlantStages.PLANT_READY)
        {
            currentStage++;
            if (currentStage > (int)PlantStages.TREATED_GROUND)
            {
                plantImage.sprite = plant.stageSprite[getPlantRealState()];
            }
        }
    }

    bool readyToReap()
    {
        if (currentStage == (int)PlantStages.PLANT_READY)
        {
            return true;
        }
        else return false;
    }

    public bool interact(PlantScriptableObject seed)
    {
        if (plant == null && currentStage == (int)PlantStages.TREATED_GROUND)
        {
            plant = seed;
            return interact(HoldingItem.SEED);
        }

        return false;
    }

    private bool couldThrowWater() {
        return currentStage >= (int)PlantStages.PLANT_SMALL && currentStage < (int)PlantStages.PLANT_READY;
    }

    public bool interact(HoldingItem playerItem)
    {
        // Return is result of shouldResetHoldingItem();
        if (currentStage == (int)PlantStages.PLANT_DIED)
        {
            return false;
        }

        if (isCorrectItem(playerItem))
        {
            passStage();
            return true;
        }

        if (playerItem == HoldingItem.WATER && couldThrowWater())
        {
            lifeBar.Reset();
            return true;
        }

        if (playerItem == HoldingItem.NOTHING && readyToReap())
        {
            GameObject.FindGameObjectWithTag("Player").GetComponent<EventsManager>().holdingPlant = plant;
            GameObject.FindGameObjectWithTag("Player").GetComponent<EventsManager>().holdingItem = HoldingItem.PLANT;
            loadInitialState();
            return false;
        }

        return false;
    }

    private bool isCorrectItem(HoldingItem playerItem)
    {
        return playerItem == HoldingItem.TOOL && currentStage == (int)PlantStages.VIRGIN_GROUND ||
            playerItem == HoldingItem.SEED && currentStage == (int)PlantStages.TREATED_GROUND;
    }
}

public enum PlantStages
{
    VIRGIN_GROUND = 1,
    TREATED_GROUND = 2,
    PLANT_SMALL = 3,
    PLANT_MEDIUM = 4,
    PLANT_GREAT = 5,
    PLANT_READY = 6,
    PLANT_DIED = 7
}
