using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class StageScript : MonoBehaviour
{
    int aux = 0;
    public GameObject virginGround;
    public GameObject plantStages;
    public LifeBar lifeBar;
    public PlantScriptableObject plant;
    public Slider slider;
    public int maxStage = 100;
    public Sprite plantImage;
    // Start is called before the first frame update
    void Start()
    {
        slider.minValue = 0;
        slider.maxValue = maxStage;
        slider.value = maxStage;
        plantImage = plant.stageSprite[1];
        plant.currentStage = 1;
        plantStages.SetActive(false);
        virginGround.SetActive(true);
    }

    // Update is called once per frame
    void Update()
    {
        if(plant.currentStage >= 2)

            if(plant.currentStage == 2)
            {
                plantStages.SetActive(false);
                virginGround.SetActive(false);
            }

            else
            {
                plantStages.SetActive(true);
                virginGround.SetActive(false);
            }

           if(slider.value >= slider.maxValue)
            {
               slider.value = maxStage;
            }
            if(slider.value <= slider.minValue)
            {
                slider.value = slider.minValue;
            }

            growing();

            passStage();

        if(lifeBar.slider.value == lifeBar.slider.minValue)
        {
            plantImage = plant.stageSprite[6];
        }
    }
    
    public void growing()
    {
        if(aux%plant.stageTime[plant.currentStage] == 0)
        {
            slider.value++;
        }
        aux++;
        if(aux == 1000)
        {
            aux = 0;
        }
    }

    public void passStage()
    {
        if(slider.value == maxStage)
        {
            slider.value = slider.minValue;
            if(plant.currentStage < 6)
            {
                plant.currentStage++;
                plantImage = plant.stageSprite[plant.currentStage];
            }

            if(plant.currentStage == 5)
            {
                readyToReap();
            }
        }
    }

    bool readyToReap()
    {
        if(plant.currentStage == 5)
        {
            return true;
        }
        else return false;
    }
}
