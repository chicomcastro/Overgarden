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

    // Start is called before the first frame update
    void Start()
    {
        loadInitialState();
    }

    // Update is called once per frame
    void Update()
    {
        if (plant.currentStage >= (int)PlantStages.PLANT_SMALL)
        {
            if (plant.currentStage == (int)PlantStages.PLANT_SMALL)
            {
                plantStages.SetActive(false);
                virginGround.SetActive(false);
            }
            else
            {
                plantStages.SetActive(true);
                virginGround.SetActive(false);
            }
        }

        if (progressionBar.value >= progressionBar.maxValue)
        {
            progressionBar.value = maxStage;
        }
        if (progressionBar.value <= progressionBar.minValue)
        {
            progressionBar.value = progressionBar.minValue;
        }

        if (plant.currentStage != (int)PlantStages.PLANT_READY && plant.currentStage != (int)PlantStages.VIRGIN_GROUND)
        {
            growing();

            passStage();
        }

        if (lifeBar.slider.value == lifeBar.slider.minValue)
        {
            if (plant.currentStage == (int)PlantStages.TREATED_GROUND)
            {
                loadInitialState();
            }
            else
            {
                plantImage.sprite = diedPlant;
                plant.currentStage = (int)PlantStages.PLANT_DIED;
            }
        }
    }

    public void loadInitialState()
    {
        progressionBar.minValue = 0;
        progressionBar.maxValue = maxStage;
        progressionBar.value = maxStage;
        plant.currentStage = (int)PlantStages.VIRGIN_GROUND;
        lifeBar.gameObject.SetActive(false);
        progressionBar.gameObject.SetActive(false);
        plantStages.SetActive(false);
        virginGround.SetActive(true);
    }

    public void growing()
    {
        if (aux % plant.stageTime[plant.currentStage] == 0)
        {
            progressionBar.value++;
        }
        aux++;
        if (aux == 1000)
        {
            aux = 0;
        }
    }

    public void passStage()
    {
        if (progressionBar.value == maxStage)
        {
            progressionBar.value = progressionBar.minValue;
            if (plant.currentStage < (int)PlantStages.PLANT_READY)
            {
                plant.currentStage++;
                plantImage.sprite = plant.stageSprite[plant.currentStage];
            }
        }
    }

    bool readyToReap()
    {
        if (plant.currentStage == (int)PlantStages.PLANT_READY)
        {
            return true;
        }
        else return false;
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
