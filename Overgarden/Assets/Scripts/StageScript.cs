using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class StageScript : MonoBehaviour
{
    int aux = 1;
    public PlantProperties properties;
    int difficulty;
    public int stage = 1; // os estagios vao de 1 a 6, cada um tem uma sprite
    public Slider slider;
    public int maxStage = 100;
    // Start is called before the first frame update
    void Start()
    {
        slider.minValue = 0;
        slider.maxValue = maxStage;
        slider.value = maxStage;
    }

    // Update is called once per frame
    void Update()
    {
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
    }
    
    public void growing()
    {
        difficulty = properties.difficultyToGrow(stage);

        if(aux%difficulty == 0) // A barra só cresce em frames "múltiplos" de difficulty.
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
            if(stage < 6)
            {
                stage++;
            }
        }
    }
}
